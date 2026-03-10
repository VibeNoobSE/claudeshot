registerGame("sword-fight", "⚔️ Sword Fight", "A/D+W+SPACE = P1, ←/→+↑+ENTER = P2", "Slash your opponent!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#2e2a1a");
    this.add.rectangle(W/2,H-15,W,30,0x3a3522);
    this.p1=this.add.rectangle(200,H-50,20,40,0xf7c948);this.p2=this.add.rectangle(W-200,H-50,20,40,0xe94560);
    this.s1=this.add.rectangle(220,H-60,30,6,0xccaa00);this.s2=this.add.rectangle(W-220,H-60,30,6,0xcc4444);
    [this.p1,this.p2].forEach(p=>{this.physics.add.existing(p);p.body.setCollideWorldBounds(true).setGravityY(600);p.setData("hp",5);p.setData("atk",0);});
    this.physics.add.collider(this.p1,this.p2);
    this.ground=this.add.rectangle(W/2,H-15,W,30);this.physics.add.existing(this.ground,true);
    this.physics.add.collider(this.p1,this.ground);this.physics.add.collider(this.p2,this.ground);
    this.hp1=this.add.text(16,16,"P1: ♥♥♥♥♥",{fontSize:"18px",color:"#f7c948",fontFamily:"monospace"});
    this.hp2=this.add.text(W-160,16,"P2: ♥♥♥♥♥",{fontSize:"18px",color:"#e94560",fontFamily:"monospace"});
    this.k=this.input.keyboard.addKeys({a:"A",d:"D",w:"W",space:"SPACE",left:"LEFT",right:"RIGHT",up:"UP",enter:Phaser.Input.Keyboard.KeyCodes.ENTER});
    this.la1=0;this.la2=0;this.over=false;
  }
  attack(atk,def,swd,dir,label,t,last){
    if(t<last+400)return last;
    swd.setRotation(dir>0?-1:1);this.time.delayedCall(200,()=>swd.setRotation(0));
    if(Math.abs(atk.x-def.x)<50&&Math.abs(atk.y-def.y)<30){
      const hp=def.getData("hp")-1;def.setData("hp",hp);
      (label==="P2"?this.hp2:this.hp1).setText(label+": "+(hp>0?"♥".repeat(hp):"DEAD"));
      def.body.setVelocityX(dir*200);
      if(hp<=0&&!this.over){this.over=true;this.add.text(W/2,H/2,(label==="P1"?"P2":"P1")+" WINS!",{fontSize:"36px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);}
    }return t;
  }
  update(t){if(this.over)return;const s=200,k=this.k;
    this.p1.body.setVelocityX(k.a.isDown?-s:k.d.isDown?s:0);
    if(k.w.isDown&&this.p1.body.touching.down)this.p1.body.setVelocityY(-400);
    this.p2.body.setVelocityX(k.left.isDown?-s:k.right.isDown?s:0);
    if(k.up.isDown&&this.p2.body.touching.down)this.p2.body.setVelocityY(-400);
    this.s1.setPosition(this.p1.x+(this.p1.x<this.p2.x?15:-15),this.p1.y-10);
    this.s2.setPosition(this.p2.x+(this.p2.x<this.p1.x?15:-15),this.p2.y-10);
    if(k.space.isDown)this.la1=this.attack(this.p1,this.p2,this.s1,1,"P2",t,this.la1);
    if(k.enter.isDown)this.la2=this.attack(this.p2,this.p1,this.s2,-1,"P1",t,this.la2);
  }
});
