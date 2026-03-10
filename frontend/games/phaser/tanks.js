registerGame("tanks", "🔫 Tanks", "WASD+SPACE = P1, Arrows+ENTER = P2", "2-player deathmatch", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1a1a1a");
    this.walls=this.physics.add.staticGroup();
    [[200,150,20,120],[400,250,120,20],[600,150,20,120],[300,400,120,20],[500,350,20,120],[150,300,20,100],[650,300,20,100],[400,100,100,20]]
      .forEach(([x,y,w,h])=>this.walls.add(this.add.rectangle(x,y,w,h,0x333333)));
    this.t1=this.add.rectangle(100,H-60,28,28,0xf7c948); this.t2=this.add.rectangle(W-100,60,28,28,0xe94560);
    [this.t1,this.t2].forEach(t=>{this.physics.add.existing(t);t.body.setCollideWorldBounds(true);t.setData("hp",3);});
    this.physics.add.collider(this.t1,this.walls); this.physics.add.collider(this.t2,this.walls); this.physics.add.collider(this.t1,this.t2);
    this.bullets=this.physics.add.group(); this.physics.add.collider(this.bullets,this.walls,(b)=>b.destroy());
    this.hp1=this.add.text(16,16,"P1: ♥♥♥",{fontSize:"16px",color:"#f7c948",fontFamily:"monospace"});
    this.hp2=this.add.text(W-160,16,"P2: ♥♥♥",{fontSize:"16px",color:"#e94560",fontFamily:"monospace"});
    this.physics.add.overlap(this.bullets,this.t1,(t,b)=>this.hit(t,b,"P1"));
    this.physics.add.overlap(this.bullets,this.t2,(t,b)=>this.hit(t,b,"P2"));
    this.k=this.input.keyboard.addKeys({w:"W",a:"A",s:"S",d:"D",space:"SPACE",up:"UP",down:"DOWN",left:"LEFT",right:"RIGHT",enter:Phaser.Input.Keyboard.KeyCodes.ENTER});
    this.a1=0;this.a2=Math.PI;this.ls1=0;this.ls2=0;
  }
  hit(tank,b,label){if(b.getData("o")===label)return;b.destroy();const hp=tank.getData("hp")-1;tank.setData("hp",hp);
    (label==="P1"?this.hp1:this.hp2).setText(label+": "+(hp>0?"♥".repeat(hp):"DEAD"));
    if(hp<=0){tank.destroy();this.add.text(W/2,H/2,(label==="P1"?"P2":"P1")+" WINS!",{fontSize:"40px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);}}
  shoot(tank,angle,owner){const b=this.add.circle(tank.x+Math.cos(angle)*22,tank.y+Math.sin(angle)*22,4,0xffffff);this.bullets.add(b);this.physics.add.existing(b);b.body.setVelocity(Math.cos(angle)*350,Math.sin(angle)*350);b.setData("o",owner);this.time.delayedCall(2000,()=>b.destroy());}
  update(t){if(!this.t1.active||!this.t2.active)return;const s=180,k=this.k;
    this.t1.body.setVelocity(0);
    if(k.a.isDown){this.t1.body.setVelocityX(-s);this.a1=Math.PI;} if(k.d.isDown){this.t1.body.setVelocityX(s);this.a1=0;}
    if(k.w.isDown){this.t1.body.setVelocityY(-s);this.a1=-Math.PI/2;} if(k.s.isDown){this.t1.body.setVelocityY(s);this.a1=Math.PI/2;}
    if(k.space.isDown&&t>this.ls1+500){this.ls1=t;this.shoot(this.t1,this.a1,"P1");}
    this.t2.body.setVelocity(0);
    if(k.left.isDown){this.t2.body.setVelocityX(-s);this.a2=Math.PI;} if(k.right.isDown){this.t2.body.setVelocityX(s);this.a2=0;}
    if(k.up.isDown){this.t2.body.setVelocityY(-s);this.a2=-Math.PI/2;} if(k.down.isDown){this.t2.body.setVelocityY(s);this.a2=Math.PI/2;}
    if(k.enter.isDown&&t>this.ls2+500){this.ls2=t;this.shoot(this.t2,this.a2,"P2");}
  }
});
