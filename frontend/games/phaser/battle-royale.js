registerGame("battle-royale", "💀 Battle Royale", "WASD = P1, Arrows = P2", "Arena shrinks — last one alive wins!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1a2a1a");
    this.zoneSize=380;this.shrinkRate=0.15;
    this.zone=this.add.circle(W/2,H/2,this.zoneSize).setStrokeStyle(3,0x4ecca3).setFillStyle(0x1a3a1a,0.3);
    this.p1=this.add.circle(W/2-60,H/2,14,0xf7c948);this.p2=this.add.circle(W/2+60,H/2,14,0xe94560);
    [this.p1,this.p2].forEach(p=>{this.physics.add.existing(p);p.body.setCollideWorldBounds(true).setBounce(0.5);p.setData("hp",100);});
    this.physics.add.collider(this.p1,this.p2);
    // Pickups
    this.pickups=this.physics.add.group();
    for(let i=0;i<8;i++){const pu=this.add.circle(Phaser.Math.Between(100,W-100),Phaser.Math.Between(80,H-80),6,0x4ecca3);this.pickups.add(pu);this.physics.add.existing(pu,true);}
    this.physics.add.overlap(this.p1,this.pickups,(p,pu)=>{pu.destroy();p.setData("hp",Math.min(100,p.getData("hp")+20));});
    this.physics.add.overlap(this.p2,this.pickups,(p,pu)=>{pu.destroy();p.setData("hp",Math.min(100,p.getData("hp")+20));});
    this.hp1=this.add.text(16,16,"P1: 100",{fontSize:"16px",color:"#f7c948",fontFamily:"monospace"});
    this.hp2=this.add.text(W-120,16,"P2: 100",{fontSize:"16px",color:"#e94560",fontFamily:"monospace"});
    this.k=this.input.keyboard.addKeys({w:"W",a:"A",s:"S",d:"D",up:"UP",down:"DOWN",left:"LEFT",right:"RIGHT"});
    this.over=false;
  }
  update(){if(this.over)return;const s=250,k=this.k,cx=W/2,cy=H/2;
    this.p1.body.setVelocity(k.a.isDown?-s:k.d.isDown?s:0,k.w.isDown?-s:k.s.isDown?s:0);
    this.p2.body.setVelocity(k.left.isDown?-s:k.right.isDown?s:0,k.up.isDown?-s:k.down.isDown?s:0);
    // Shrink zone
    this.zoneSize=Math.max(60,this.zoneSize-this.shrinkRate);
    this.zone.setRadius(this.zoneSize);
    // Damage outside zone
    [["P1",this.p1,this.hp1],["P2",this.p2,this.hp2]].forEach(([label,p,hpTxt])=>{
      if(Phaser.Math.Distance.Between(p.x,p.y,cx,cy)>this.zoneSize){
        const hp=p.getData("hp")-0.5;p.setData("hp",hp);hpTxt.setText(label+": "+Math.round(hp));
        if(hp<=0&&!this.over){this.over=true;this.add.text(W/2,H/2,(label==="P1"?"P2":"P1")+" WINS!",{fontSize:"36px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);}
      }
    });
  }
});
